#!/usr/bin/env bash
#
# Provisions a minimal, cheap MySQL RDS instance for the Wayfare flight
# booking demo: single-AZ db.t4g.micro, 20GB gp3, publicly accessible but
# locked down (via security group) to only the IP address running this
# script.
#
# Prerequisites:
#   - AWS CLI v2, `jq`, `curl`, `openssl` installed
#   - Credentials for a principal that has rds:* and the ec2 networking
#     read/write actions in ./iam-policy.json attached
#     (the default `harsha-agent-mcp-deploy` user does NOT have these —
#     someone with IAM admin rights needs to attach that policy first)
#
# Usage:
#   ./create-rds.sh
#
# Idempotency: safe to re-run — it reuses the security group / subnet
# group / DB instance if they already exist instead of failing.

set -euo pipefail

REGION="${AWS_REGION:-us-east-2}"
DB_INSTANCE_ID="${DB_INSTANCE_ID:-wayfare-flights-db}"
DB_NAME="${DB_NAME:-wayfare}"
DB_USER="${DB_USER:-wayfare_app}"
SG_NAME="${SG_NAME:-wayfare-rds-sg}"
SUBNET_GROUP_NAME="${SUBNET_GROUP_NAME:-wayfare-db-subnet-group}"
INSTANCE_CLASS="${INSTANCE_CLASS:-db.t4g.micro}"
ALLOCATED_STORAGE="${ALLOCATED_STORAGE:-20}"
ENGINE_VERSION="${ENGINE_VERSION:-8.0}"

echo "== Wayfare RDS provisioning (region: $REGION) =="

echo "-- Resolving default VPC..."
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "No default VPC found in $REGION. Create/select a VPC and set VPC_ID manually in this script." >&2
  exit 1
fi
echo "   VPC: $VPC_ID"

echo "-- Resolving subnets in that VPC..."
SUBNET_IDS=$(aws ec2 describe-subnets --region "$REGION" --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[].SubnetId' --output text)
SUBNET_COUNT=$(echo "$SUBNET_IDS" | wc -w | tr -d ' ')
if [ "$SUBNET_COUNT" -lt 2 ]; then
  echo "Need at least 2 subnets (in different AZs) for an RDS subnet group; found $SUBNET_COUNT." >&2
  exit 1
fi
echo "   Subnets: $SUBNET_IDS"

echo "-- Detecting this machine's public IP (to scope the security group)..."
MY_IP=$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')
echo "   Public IP: $MY_IP"

echo "-- Ensuring security group '$SG_NAME' exists..."
SG_ID=$(aws ec2 describe-security-groups --region "$REGION" \
  --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group --region "$REGION" \
    --group-name "$SG_NAME" \
    --description "Wayfare flight booking demo - MySQL RDS access" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)
  echo "   Created security group: $SG_ID"
else
  echo "   Reusing existing security group: $SG_ID"
fi

echo "-- Ensuring inbound rule for 3306 from $MY_IP/32..."
aws ec2 authorize-security-group-ingress --region "$REGION" \
  --group-id "$SG_ID" \
  --protocol tcp --port 3306 --cidr "${MY_IP}/32" \
  >/dev/null 2>&1 || echo "   (rule already present, continuing)"

echo "-- Ensuring DB subnet group '$SUBNET_GROUP_NAME' exists..."
if ! aws rds describe-db-subnet-groups --region "$REGION" --db-subnet-group-name "$SUBNET_GROUP_NAME" >/dev/null 2>&1; then
  aws rds create-db-subnet-group --region "$REGION" \
    --db-subnet-group-name "$SUBNET_GROUP_NAME" \
    --db-subnet-group-description "Wayfare flight booking demo" \
    --subnet-ids $SUBNET_IDS >/dev/null
  echo "   Created DB subnet group."
else
  echo "   Reusing existing DB subnet group."
fi

echo "-- Checking for existing DB instance '$DB_INSTANCE_ID'..."
if aws rds describe-db-instances --region "$REGION" --db-instance-identifier "$DB_INSTANCE_ID" >/dev/null 2>&1; then
  echo "   Instance already exists — skipping creation."
else
  DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)

  echo "-- Creating RDS instance '$DB_INSTANCE_ID' ($INSTANCE_CLASS, MySQL $ENGINE_VERSION)..."
  aws rds create-db-instance --region "$REGION" \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --db-instance-class "$INSTANCE_CLASS" \
    --engine mysql \
    --engine-version "$ENGINE_VERSION" \
    --allocated-storage "$ALLOCATED_STORAGE" \
    --storage-type gp3 \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" \
    --db-name "$DB_NAME" \
    --vpc-security-group-ids "$SG_ID" \
    --db-subnet-group-name "$SUBNET_GROUP_NAME" \
    --backup-retention-period 1 \
    --no-multi-az \
    --publicly-accessible \
    --no-deletion-protection \
    --tags Key=project,Value=wayfare-flight-booking \
    >/dev/null

  echo
  echo "=================================================================="
  echo " DB_USER=$DB_USER"
  echo " DB_PASSWORD=$DB_PASSWORD"
  echo " (save this now — it will not be shown again by this script)"
  echo "=================================================================="
  echo
fi

echo "-- Waiting for the instance to become available (this can take 5-10 minutes)..."
aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DB_INSTANCE_ID"

ENDPOINT=$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$DB_INSTANCE_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text)
PORT=$(aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$DB_INSTANCE_ID" \
  --query 'DBInstances[0].Endpoint.Port' --output text)

echo
echo "RDS instance is available."
echo "  DB_HOST=$ENDPOINT"
echo "  DB_PORT=$PORT"
echo "  DB_NAME=$DB_NAME"
echo
echo "Next steps:"
echo "  1. Put DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME into server/.env"
echo "  2. mysql -h $ENDPOINT -P $PORT -u $DB_USER -p $DB_NAME < ../db/schema.sql"
echo "  3. cd .. && npm install && npm run seed"
echo "  4. npm start"

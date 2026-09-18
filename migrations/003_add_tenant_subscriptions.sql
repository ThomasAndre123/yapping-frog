ALTER TABLE tenants
ADD COLUMN subscription_type TEXT NOT NULL DEFAULT 'free',
ADD COLUMN subscription_valid_until TIMESTAMPTZ;

ALTER TABLE tenants
ADD CONSTRAINT tenants_subscription_type_not_empty
    CHECK (BTRIM(subscription_type) <> ''),
ADD CONSTRAINT tenants_subscription_type_length
    CHECK (CHAR_LENGTH(subscription_type) <= 50);

COMMENT ON COLUMN tenants.subscription_type IS
    'Flexible plan identifier such as free, trial, pro, or enterprise';

COMMENT ON COLUMN tenants.subscription_valid_until IS
    'Subscription expiration instant; NULL means the subscription is valid forever';

CREATE INDEX tenants_subscription_expiration_idx
ON tenants (subscription_valid_until)
WHERE subscription_valid_until IS NOT NULL;

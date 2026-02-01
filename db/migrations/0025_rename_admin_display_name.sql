-- Change admin user display name from "support" to "Digital Sebastian"
UPDATE users SET displayName = 'Digital Sebastian' WHERE id = 23 AND displayName = 'support';

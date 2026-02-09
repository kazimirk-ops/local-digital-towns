-- Rename Sebastian-specific column names to generic equivalents
ALTER TABLE users RENAME COLUMN "locationverifiedsebastian" TO "locationverified";
ALTER TABLE local_business_applications RENAME COLUMN "confirmsebastian" TO "confirmlocalbusiness";
ALTER TABLE business_applications RENAME COLUMN "insebastian" TO "intown";
ALTER TABLE resident_applications RENAME COLUMN "yearsinsebastian" TO "yearsintown";

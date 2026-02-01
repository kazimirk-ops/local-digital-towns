-- Cancel sweepstakes 5, 6, 9 that are still showing as active
UPDATE sweepstakes SET status = 'cancelled' WHERE id IN (5, 6, 9) AND status != 'cancelled';

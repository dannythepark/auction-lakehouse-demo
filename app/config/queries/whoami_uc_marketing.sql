-- Who Unity Catalog sees for the Marketing-rep persona (the app's service principal).
SELECT current_user() AS uc_identity

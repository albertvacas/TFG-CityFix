-- Índex espacial GiST sobre la columna geography 'location' de reports.
-- Necessari perquè les consultes espacials (ST_Distance / ST_DWithin) siguin
-- eficients a escala (RNF-03). Sense aquest índex, PostGIS fa un scan seqüencial.
--
-- S'aplica un sol cop (idempotent). El planificador l'usa automàticament en
-- ordenacions/filtres per proximitat sobre 'location'.

CREATE INDEX IF NOT EXISTS idx_reports_location
  ON reports
  USING GIST (location);

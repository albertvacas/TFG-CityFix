-- Trigger PL/pgSQL: sincronitza automàticament la columna 'location'
-- a partir de latitude i longitude cada cop que s'insereix o actualitza un report.

CREATE OR REPLACE FUNCTION sync_report_location()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar el trigger a la taula reports
DROP TRIGGER IF EXISTS trg_sync_report_location ON reports;
CREATE TRIGGER trg_sync_report_location
  BEFORE INSERT OR UPDATE OF latitude, longitude
  ON reports
  FOR EACH ROW
  EXECUTE FUNCTION sync_report_location();

-- Actualitzar els reports existents que no tinguin location
UPDATE reports
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

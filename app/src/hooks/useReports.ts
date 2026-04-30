import { useCallback, useEffect, useState } from 'react';
import * as reportsApi from '../api/reports';
import type { Report } from '../types';

export function useReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportsApi.getAllReports();
      setReports(data);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Error carregant incidències');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { reports, loading, error, refresh };
}

export function useReport(id: string | undefined) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await reportsApi.getReportById(id);
      setReport(data);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Error carregant la incidència');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { report, loading, error, refresh, setReport };
}

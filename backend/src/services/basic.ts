import { prisma } from '../config/db';

export const getIncidentById = (id: string) => {
  return prisma.report.findUnique({ where: { report_id: id } });
};

export const updateIncidentState = (id: string, newState: string) => {
  return prisma.report.update({
    where: { report_id: id },
    data: { state: newState as any }
  });
};
import { prisma } from '../db';
import { Forbidden } from '../errors';

export type ProductModule = 'HRMS' | 'SALES';

export async function assertModuleEntitlement(tenantId: string, module: ProductModule) {
  const entitlement = await prisma.moduleEntitlement.findUnique({
    where: { tenantId_module: { tenantId, module } },
  });
  const usable = entitlement &&
    ['TRIAL', 'ACTIVE', 'GRACE'].includes(entitlement.state) &&
    (!entitlement.endsAt || entitlement.endsAt > new Date());
  if (!usable) {
    throw Forbidden(`${module === 'HRMS' ? 'HR' : 'Sales'} is not enabled for this company.`);
  }
  return entitlement;
}

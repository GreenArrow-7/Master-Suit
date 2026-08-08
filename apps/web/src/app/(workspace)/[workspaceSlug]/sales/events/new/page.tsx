import { requirePageAccess } from '@/lib/workspace-page';
import NewEventForm from './NewEventForm';

/** Server wrapper: see the note in ../../calls/new/page.tsx. */
export const metadata = { title: 'New event' };

export default async function NewEventPage() {
  await requirePageAccess({ module: 'SALES', permission: ['events', 'CREATE'] });
  return <NewEventForm />;
}

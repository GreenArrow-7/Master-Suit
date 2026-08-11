import { redirect } from 'next/navigation';

/** Offboarding, opening the joining-and-leaving screen in its exit mode. */
export const metadata = { title: 'Offboarding' };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/people/lifecycle?mode=offboarding`);
}

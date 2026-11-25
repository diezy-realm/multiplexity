import { getServerSession } from '@/server/auth/session';
export async function currentUserId(): Promise<string | undefined> {
  const session = await getServerSession();
  return (session?.user as { id?: string } | undefined)?.id;
}

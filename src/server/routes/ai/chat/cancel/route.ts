import { getServerSession } from '@/server/auth/session';
import { chatOperations } from '@/lib/ai/operations';

export async function POST() {
  const session = await getServerSession();
  const user = (session?.user as { id?: string } | undefined)?.id;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  chatOperations.get(user)?.abort();
  return Response.json({ success: true });
}

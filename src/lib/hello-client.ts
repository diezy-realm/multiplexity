export async function registerHello(_password: string): Promise<never> {
  throw new Error('Windows Hello dinonaktifkan.');
}

export async function verifyHello(_username: string): Promise<never> {
  throw new Error('Windows Hello dinonaktifkan.');
}

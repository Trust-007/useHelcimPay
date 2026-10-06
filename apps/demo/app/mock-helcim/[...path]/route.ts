import { getSimulator, helcimMode } from '@/lib/helcim';

export const dynamic = 'force-dynamic';

/**
 * The HelcimPay simulator (start.js, the payment modal page, card
 * processing). Only mounted in mock mode.
 */
async function handle(request: Request): Promise<Response> {
  if (helcimMode() !== 'mock') return new Response('Not found', { status: 404 });
  try {
    return await getSimulator().handle(request);
  } catch (error) {
    console.error(error);
    return Response.json(
      { errors: error instanceof Error ? error.message : 'Simulator error' },
      { status: 500 },
    );
  }
}

export { handle as GET, handle as POST };

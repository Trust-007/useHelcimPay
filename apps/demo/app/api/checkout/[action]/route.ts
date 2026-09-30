import { getCheckoutHandlers } from '@/lib/helcim';

export const dynamic = 'force-dynamic';

/** POST /api/checkout/initialize and POST /api/checkout/validate */
export async function POST(request: Request, ctx: RouteContext<'/api/checkout/[action]'>) {
  const { action } = await ctx.params;
  let handlers: ReturnType<typeof getCheckoutHandlers>;
  try {
    handlers = getCheckoutHandlers();
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Server misconfigured' },
      { status: 500 },
    );
  }

  if (action === 'initialize') return handlers.initialize(request);
  if (action === 'validate') return handlers.validate(request);
  return Response.json({ error: 'Not found' }, { status: 404 });
}

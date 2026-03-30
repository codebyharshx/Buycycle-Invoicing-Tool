/**
 * Agents API Route
 * Returns list of agents for assignment and display purposes
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/agents
 * List all available agents
 */
export async function GET(request: NextRequest) {
  // Mock agents - replace with actual database query when needed
  const agents = [
    { id: 1, email: 'agent1@buycycle.com', firstName: 'Agent', lastName: 'One', role: 'admin' },
    { id: 2, email: 'agent2@buycycle.com', firstName: 'Agent', lastName: 'Two', role: 'user' },
  ];

  return NextResponse.json({ success: true, data: agents });
}

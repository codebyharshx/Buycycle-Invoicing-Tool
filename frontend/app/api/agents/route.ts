/**
 * Agents API Route
 * Returns list of agents for assignment and display purposes
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';

/**
 * GET /api/agents
 * List all available agents, including the current user
 */
export async function GET(request: NextRequest) {
  try {
    // Get current user from Clerk
    const user = await currentUser();

    // Base mock agents
    const agents = [
      { id: 1, email: 'agent1@buycycle.com', firstName: 'Agent', lastName: 'One', role: 'admin' },
      { id: 2, email: 'agent2@buycycle.com', firstName: 'Agent', lastName: 'Two', role: 'user' },
    ];

    // Add current Clerk user if logged in
    if (user) {
      const clerkEmail = user.emailAddresses[0]?.emailAddress;
      if (clerkEmail && !agents.some(a => a.email === clerkEmail)) {
        agents.unshift({
          id: 100 + agents.length, // Unique ID for Clerk user
          email: clerkEmail,
          firstName: user.firstName || 'User',
          lastName: user.lastName || '',
          role: 'user',
        });
      }
    }

    return NextResponse.json({ success: true, data: agents });
  } catch {
    // Fallback if Clerk is not configured
    return NextResponse.json({
      success: true,
      data: [
        { id: 1, email: 'agent1@buycycle.com', firstName: 'Agent', lastName: 'One', role: 'admin' },
        { id: 2, email: 'agent2@buycycle.com', firstName: 'Agent', lastName: 'Two', role: 'user' },
      ]
    });
  }
}

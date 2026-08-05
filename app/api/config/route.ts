import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await prisma.cafeConfig.findUnique({
      where: { userId: session.user.id }
    });

    return NextResponse.json({ config: config || {} });
  } catch (error) {
    console.error('Failed to get config:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const config = await prisma.cafeConfig.upsert({
      where: { userId: session.user.id },
      update: body,
      create: {
        userId: session.user.id,
        ...body
      }
    });

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error('Failed to save config:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

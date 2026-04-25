import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireRole, withAuth, getAuthenticatedUser } from './auth'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

describe('Auth Middleware', () => {
  const mockUser = {
    id: 'user-123',
    user_metadata: { role: 'admin' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAuthenticatedUser', () => {
    it('should return user when authenticated', async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
        },
      }
      vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

      const request = new NextRequest('http://localhost')
      const user = await getAuthenticatedUser(request)

      expect(user).toEqual(mockUser)
    })

    it('should throw unauthorized error when not authenticated', async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('No session') }),
        },
      }
      vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

      const request = new NextRequest('http://localhost')
      await expect(getAuthenticatedUser(request)).rejects.toThrow('Invalid or expired session')
    })
  })

  describe('requireRole', () => {
    it('should allow user with correct role', async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
        },
      }
      vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

      const request = new NextRequest('http://localhost')
      const user = await requireRole(request, ['admin', 'super-user'])

      expect(user).toEqual(mockUser)
    })

    it('should throw forbidden error when user has wrong role', async () => {
      const mockUserNormal = {
        id: 'user-456',
        user_metadata: { role: 'user' },
      }
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUserNormal }, error: null }),
        },
      }
      vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

      const request = new NextRequest('http://localhost')
      await expect(requireRole(request, ['admin'])).rejects.toThrow('Requires one of: admin')
    })
  })

  describe('withAuth', () => {
    it('should wrap handler and provide user', async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
        },
      }
      vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

      const handler = vi.fn().mockResolvedValue(new NextResponse())
      const wrapped = withAuth(handler)

      const request = new NextRequest('http://localhost')
      await wrapped(request)

      expect(handler).toHaveBeenCalledWith(request, mockUser)
    })

    it('should enforce role when specified in options', async () => {
      const mockUserNormal = {
        id: 'user-456',
        user_metadata: { role: 'user' },
      }
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUserNormal }, error: null }),
        },
      }
      vi.mocked(createClient).mockResolvedValue(mockSupabase as any)

      const handler = vi.fn()
      const wrapped = withAuth(handler, { requireRole: ['admin'] })

      const request = new NextRequest('http://localhost')
      await expect(wrapped(request)).rejects.toThrow('Requires one of: admin')
      expect(handler).not.toHaveBeenCalled()
    })
  })
})

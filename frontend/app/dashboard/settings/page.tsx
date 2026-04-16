'use client';

/**
 * Settings Page
 * User and application settings
 */

import { useEffect } from 'react';
import { usePageHeader } from '@/components/providers';
import { useAuth } from '@/components/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, Shield, Bell, Palette } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { setHeader } = usePageHeader();
  const { user } = useAuth();

  useEffect(() => {
    setHeader({ title: 'Settings' });
  }, [setHeader]);

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/invoices">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Invoices
          </Button>
        </Link>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-gray-500" />
            <CardTitle>Profile</CardTitle>
          </div>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={user?.name || ''} disabled />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <div>
              <Badge variant={user?.role === 'admin' ? 'destructive' : user?.role === 'manager' ? 'default' : 'secondary'}>
                {user?.role || 'member'}
              </Badge>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            Contact an administrator to update your profile information.
          </p>
        </CardContent>
      </Card>

      {/* Security Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-gray-500" />
            <CardTitle>Security</CardTitle>
          </div>
          <CardDescription>Manage your password and security settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Password</p>
              <p className="text-sm text-gray-500">Change your password</p>
            </div>
            <Button variant="outline" disabled>
              Change Password
            </Button>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Last Login</p>
              <p className="text-sm text-gray-500">
                {user?.last_login_at
                  ? new Date(user.last_login_at).toLocaleString()
                  : 'Never'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications Section (Coming Soon) */}
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-gray-500" />
            <CardTitle>Notifications</CardTitle>
            <Badge variant="outline">Coming Soon</Badge>
          </div>
          <CardDescription>Configure how you receive notifications</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Notification settings will be available in a future update.
          </p>
        </CardContent>
      </Card>

      {/* Appearance Section (Coming Soon) */}
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-gray-500" />
            <CardTitle>Appearance</CardTitle>
            <Badge variant="outline">Coming Soon</Badge>
          </div>
          <CardDescription>Customize the look and feel of the application</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Theme and appearance settings will be available in a future update.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

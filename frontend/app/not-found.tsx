import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted p-4">
      <Card className="max-w-2xl w-full">
        <CardContent className="px-5 py-5 pt-12 pb-12 text-center">
          <div className="mb-8 flex justify-center">
            <div className="relative">
              <FileQuestion className="h-24 w-24 text-muted-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-4">
            Page Not Found
          </h1>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <Link href="/dashboard/invoices">
            <Button size="lg">Go to Invoices</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

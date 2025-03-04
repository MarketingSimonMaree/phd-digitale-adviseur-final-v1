"use client";

import InteractiveAvatar from "@/components/InteractiveAvatar";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl" style={{ height: "80vh" }}>
        <InteractiveAvatar />
      </div>
    </main>
  );
}

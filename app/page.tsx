import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Retry a few times — trigger may take a moment on first login
  let profile = null;
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (data) {
      profile = data;
      break;
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  redirect(profile?.role === "coach" ? "/coach" : "/pathway");
}

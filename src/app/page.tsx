import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";

export default async function Root() {
  const u = await getSessionUser();
  redirect(!u ? "/login" : u.role === "SUPER_ADMIN" ? "/platform" : "/home");
}

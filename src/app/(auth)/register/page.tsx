import { RegisterGymForm } from "@/components/auth/register-gym-form";
import { CardDescription, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Register your gym — GymFlow" };

export default function RegisterPage() {
  return (
    <div className="space-y-5">
      <div>
        <CardTitle>Register your gym</CardTitle>
        <CardDescription>
          Claim your gym URL and start a 14-day trial. No card needed yet.
        </CardDescription>
      </div>
      <RegisterGymForm />
    </div>
  );
}

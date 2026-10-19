// The roles onboarding asks for (phase1-plan.md, item U3), in the order step 1 lists them, with
// what each one's first dashboard is set up with. The names match api/intelmonitor/server/profiles.py.
import type { Role } from "@/lib/api/queries";

export const ROLES: { role: Role; name: string; suggests: string }[] = [
  { role: "regulatory_supervisor", name: "Regulatory supervisor", suggests: "Suggested: DBS, OCBC and UOB." },
  {
    role: "tech_cyber_supervisor",
    name: "Technology and cyber risk supervisor",
    suggests:
      "Suggested: DBS, OCBC and UOB, the technology providers and payment systems they use, and outage and cyber topics.",
  },
  {
    role: "development_staff",
    name: "Development staff",
    suggests: "Suggested: market topics such as Singapore equities and asset management, with SGX and HKEX.",
  },
  { role: "other", name: "Other", suggests: "Suggested: the entities MAS supervises that this app tracks: DBS, OCBC and UOB." },
];

export const roleName = (role: Role) => ROLES.find((r) => r.role === role)?.name ?? role;

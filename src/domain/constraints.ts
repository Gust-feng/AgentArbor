export type Constraint = {
  id: string;
  source:
    | "user"
    | "underground_center"
    | "agentarbor_handoff"
    | "aboveground_center"
    | "aboveground_growth"
    | "verification"
    | "governance"
    | "soil"
    | "external";
  type:
    | "goal"
    | "non_goal"
    | "scope"
    | "permission"
    | "cost"
    | "time"
    | "technical"
    | "data_security"
    | "human_approval"
    | "verification"
    | "asset_governance"
    | "evolution";
  level: "hard" | "soft" | "preference";
  statement: string;
  owner:
    | "user"
    | "underground_center"
    | "aboveground_center"
    | "verification"
    | "governance";
  appliesTo: string[];
  evidenceRefs: string[];
  enforcementGate:
    | "direction_handoff"
    | "growth_plan"
    | "task_assignment"
    | "tool_execution"
    | "verification"
    | "fruit_governance"
    | "soil_promotion";
  conflictPolicy:
    | "block"
    | "ask_user"
    | "aboveground_center_decides"
    | "verification_reviews"
    | "governance_review";
  status:
    | "proposed"
    | "approved"
    | "active"
    | "waived"
    | "violated"
    | "retired";
};

export type ConstraintRef = {
  constraintId: string;
  requiredLevel: "hard" | "soft" | "preference";
  enforcementGate: Constraint["enforcementGate"];
};

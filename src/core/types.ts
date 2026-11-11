// Shared data shapes. Everything in src/core is pure: no Forge imports, no I/O,
// so the handover logic can be unit-tested without a Jira site.

export type StatusCategory = 'new' | 'indeterminate' | 'done';

export interface Person {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
}

/** One comment on a work item: who wrote it and when (ISO timestamp). */
export interface Activity {
  accountId: string;
  displayName: string;
  at: string;
}

export type PullRequestStatus = 'OPEN' | 'DRAFT' | 'MERGED' | 'DECLINED' | 'UNKNOWN';

export interface PullRequest {
  id: string;
  title: string;
  url?: string;
  status: PullRequestStatus;
  displayId?: string;
  updated?: string;
  /** Jira key of the work item this pull request is linked to, when known. */
  workItemKey?: string;
}

export interface WorkItem {
  key: string;
  id: string;
  summary: string;
  url: string;
  status: string;
  statusCategory: StatusCategory;
  priority?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
  /** ISO timestamp */
  updated: string;
  issueType?: string;
  projectKey: string;
  parentKey?: string;
  parentSummary?: string;
  labels: string[];
  components: string[];
  reporter?: Person;
  /** Oldest first. */
  comments: Activity[];
  /** True when an unresolved "is blocked by" link exists. */
  blocked: boolean;
  /** Keys of the unresolved items blocking this one, when known. */
  blockedBy?: string[];
  pullRequests: PullRequest[];
  /** The latest walkthrough Understudy asked for on this item, when there is one. */
  walkthrough?: { learner: string; learnerId: string; at: string };
}

export interface Goal {
  id: string;
  name: string;
  url?: string;
  kind: 'goal' | 'project';
  state?: string;
  /** YYYY-MM-DD */
  due?: string;
}

export interface Page {
  id: string;
  title: string;
  url: string;
  lastModified?: string;
  space?: string;
}

/** A recent work item owned by someone else: evidence of what that person knows. */
export interface PeerWork {
  accountId: string;
  displayName: string;
  issueKey: string;
  projectKey: string;
  parentKey?: string;
  labels: string[];
  components: string[];
  updated: string;
}

export interface Teammate {
  accountId: string;
  displayName: string;
  teams: string[];
}

/** Inclusive dates, YYYY-MM-DD. */
export interface Absence {
  start: string;
  end: string;
}

export type SourceState = 'ok' | 'empty' | 'unavailable';

export interface Sources {
  jira: SourceState;
  confluence: SourceState;
  teamworkGraph: SourceState;
  notes: string[];
}

/** Everything Understudy knows about one person's work at one moment. */
export interface Snapshot {
  person: Person;
  absence: Absence;
  /** YYYY-MM-DD, the day the snapshot was taken. */
  today: string;
  siteUrl?: string;
  workItems: WorkItem[];
  pullRequests: PullRequest[];
  goals: Goal[];
  pages: Page[];
  teammates: Teammate[];
  peerWork: PeerWork[];
  /** Open (not done) work items currently assigned, by accountId. */
  openLoad: Record<string, number>;
  /** All open items the person has, when there were more than could be planned. */
  openTotal?: number;
  sources: Sources;
}

export type PromptRecord = {
  id: string;
  name: string;
  text: string;
  json_data: Record<string, unknown>;
  fingerprint: string;
  variables: string[];
  keywords: string[];
  created_at: string;
  updated_at: string;
  source?: string;
};

export type PromptDraft = Omit<PromptRecord, 'id' | 'created_at' | 'updated_at' | 'fingerprint'> & {
  id?: string;
  fingerprint?: string;
  created_at?: string;
  updated_at?: string;
};

export type PromptSearchFilters = {
  query: string;
  keyword?: string;
};

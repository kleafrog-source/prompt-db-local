import { usePromptStore } from '@/store/promptStore';

export const usePrompts = () => {
  const prompts = usePromptStore((state) => state.prompts);
  const filters = usePromptStore((state) => state.filters);
  const selectedPromptId = usePromptStore((state) => state.selectedPromptId);

  const query = filters.query.trim().toLowerCase();
  const keyword = filters.keyword?.trim().toLowerCase();

  const filteredPrompts = prompts.filter((prompt) => {
    const matchesQuery =
      !query ||
      prompt.name.toLowerCase().includes(query) ||
      prompt.text.toLowerCase().includes(query) ||
      prompt.keywords.some((entry) => entry.includes(query));
    const matchesKeyword = !keyword || prompt.keywords.includes(keyword);

    return matchesQuery && matchesKeyword;
  });

  const selectedPrompt =
    prompts.find((prompt) => prompt.id === selectedPromptId) ?? filteredPrompts[0] ?? null;

  return {
    prompts,
    filteredPrompts,
    selectedPrompt,
  };
};

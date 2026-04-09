import type { AgentOutputEvent, TokenUsageEvent } from '../../types';

type UsageListener = (event: TokenUsageEvent) => void;
const usageListeners: UsageListener[] = [];

export const subscribeToTokenUsage = (cb: UsageListener): (() => void) => {
    usageListeners.push(cb);
    return () => {
        const index = usageListeners.indexOf(cb);
        if (index >= 0) usageListeners.splice(index, 1);
    };
};

export const emitUsage = (event: Omit<TokenUsageEvent, 'id' | 'timestamp'>) => {
    if (usageListeners.length === 0) return;

    const full: TokenUsageEvent = {
        ...event,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
    };

    usageListeners.forEach(cb => cb(full));
};

type AgentOutputListener = (event: AgentOutputEvent) => void;
const agentListeners: AgentOutputListener[] = [];

export const subscribeToAgentOutput = (cb: AgentOutputListener): (() => void) => {
    agentListeners.push(cb);
    return () => {
        const index = agentListeners.indexOf(cb);
        if (index >= 0) agentListeners.splice(index, 1);
    };
};

export const emitAgentOutput = (
    event: Omit<AgentOutputEvent, 'id' | 'timestamp'>,
    sanitizeText: (value: string) => string,
) => {
    if (agentListeners.length === 0) return;

    const full: AgentOutputEvent = {
        ...event,
        label: typeof event.label === 'string' ? sanitizeText(event.label) : event.label,
        summary: typeof event.summary === 'string' ? sanitizeText(event.summary) : event.summary,
        detail: typeof event.detail === 'string' ? sanitizeText(event.detail) : event.detail,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
    };

    agentListeners.forEach(cb => cb(full));
};

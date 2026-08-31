import { randomUUID } from 'node:crypto';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

type AuthType = 'oauth' | 'api_key';
type FlowStatus = 'running' | 'waiting' | 'completed' | 'error' | 'cancelled';
type Prompt = { type: 'text'|'secret'|'manual_code'; message: string; placeholder?: string } | { type: 'select'; message: string; options: Array<{ id: string; label: string; description?: string }> };
type Message = { type: 'info'|'auth_url'|'device_code'|'progress'; message?: string; url?: string; userCode?: string; verificationUri?: string };
export interface PublicAuthFlow { flowId: string; provider: string; authType: AuthType; status: FlowStatus; messages: Message[]; prompt?: Prompt; error?: string }
interface InternalFlow extends PublicAuthFlow { controller: AbortController; answer?: (value: string) => void; reject?: (error: Error) => void }

export class PiAuthBroker {
  private runtime?: ModelRuntime;
  private readonly flows = new Map<string, InternalFlow>();
  private async models(): Promise<ModelRuntime> { return this.runtime ??= await ModelRuntime.create({ allowModelNetwork: false }); }
  async methods() {
    const runtime = await this.models();
    return runtime.getProviders().map((provider) => ({
      id: provider.id, name: provider.name, configured: runtime.hasConfiguredAuth(provider.id),
      methods: ([provider.auth.oauth && 'oauth', provider.auth.apiKey?.login && 'api_key'].filter(Boolean) as AuthType[]),
    })).filter((provider) => provider.methods.length > 0);
  }
  async start(provider: string, authType: AuthType): Promise<PublicAuthFlow> {
    const runtime = await this.models();
    const available = (await this.methods()).find((item) => item.id === provider);
    if (!available?.methods.includes(authType)) throw new Error(`${provider} does not support ${authType} login`);
    const flow: InternalFlow = { flowId: `auth-${randomUUID()}`, provider, authType, status: 'running', messages: [], controller: new AbortController() };
    this.flows.set(flow.flowId, flow);
    void runtime.login(provider, authType, {
      signal: flow.controller.signal,
      notify: (event: any) => {
        if (event.type === 'info') flow.messages.push({ type: 'info', message: event.message });
        if (event.type === 'progress') flow.messages.push({ type: 'progress', message: event.message });
        if (event.type === 'auth_url') flow.messages.push({ type: 'auth_url', url: event.url, message: event.instructions });
        if (event.type === 'device_code') flow.messages.push({ type: 'device_code', userCode: event.userCode, verificationUri: event.verificationUri });
      },
      prompt: (prompt: any) => new Promise<string>((resolve, reject) => {
        flow.prompt = { ...prompt, signal: undefined }; flow.status = 'waiting'; flow.answer = resolve; flow.reject = reject;
      }),
    }).then(() => { flow.status = 'completed'; flow.prompt = undefined; flow.messages.push({ type: 'info', message: `Connected to ${provider}.` }); })
      .catch((error) => { flow.status = flow.controller.signal.aborted ? 'cancelled' : 'error'; flow.prompt = undefined; flow.error = error instanceof Error ? error.message : String(error); });
    return this.public(flow);
  }
  get(flowId: string): PublicAuthFlow { const flow = this.require(flowId); return this.public(flow); }
  respond(flowId: string, response: string): boolean { const flow = this.require(flowId); if (!flow.answer) return false; const answer = flow.answer; flow.answer = undefined; flow.reject = undefined; flow.prompt = undefined; flow.status = 'running'; answer(response); return true; }
  cancel(flowId: string): boolean { const flow = this.require(flowId); flow.controller.abort(); flow.reject?.(new Error('Login cancelled')); flow.status = 'cancelled'; flow.prompt = undefined; return true; }
  async logout(provider: string): Promise<boolean> { await (await this.models()).logout(provider); return true; }
  private require(id: string): InternalFlow { const flow = this.flows.get(id); if (!flow) throw new Error(`No such authentication flow: ${id}`); return flow; }
  private public(flow: InternalFlow): PublicAuthFlow { return { flowId: flow.flowId, provider: flow.provider, authType: flow.authType, status: flow.status, messages: [...flow.messages], ...(flow.prompt ? { prompt: flow.prompt } : {}), ...(flow.error ? { error: flow.error } : {}) }; }
}

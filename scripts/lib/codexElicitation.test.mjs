import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { elicitationRequest, serveElicitation } from '../../spike/codex-elicitation-server.mjs';
import { projectElicitation, projectMcpAnswer } from '../../spike/codex-elicitation-verification.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../spike/__fixtures__/codex-elicitation-0160.json', import.meta.url), 'utf8'));

describe('Codex elicitation artificial', () => {
  it.each(fixture.records)('serveElicitation_$kind_$action_preservesMeasuredExchange', (record) => {
    const input = new EventEmitter();
    const output = [];
    serveElicitation({ readLines: () => input, write: (line) => output.push(JSON.parse(line)) });

    input.emit('line', JSON.stringify({ id: 1, method: 'tools/call', params: { name: record.kind, arguments: {} } }));
    const request = output[0];
    input.emit('line', JSON.stringify({ id: request.id, result: JSON.parse(record.mcpResult.content[0].text) }));

    expect(request).toMatchObject({ method: 'elicitation/create', params: elicitationRequest(record.kind) });
    expect(output[1]).toEqual({ jsonrpc: '2.0', id: 1, result: record.mcpResult });
    expect(projectElicitation(record.request.params, record.kind)).toEqual(record.request.params);
    const expected = record.action === 'accept' ? record.response.result : { action: record.action };
    expect(projectMcpAnswer({ result: record.mcpResult }, expected)).toEqual(record.mcpResult);
  });

  it.each(['_meta', 'message', 'requestedSchema'])('projectElicitation_external$0_rejectsBeforeRecording', (field) => {
    const params = { ...fixture.records[0].request.params, [field]: 'synthetic-do-not-record' };

    const act = () => projectElicitation(params, 'confirmation');

    expect(act).toThrow(/Elicitation artificial:/);
    expect(act).not.toThrow(/synthetic-do-not-record/);
  });

  it('projectMcpAnswer_externalError_omitsItsMessage', () => {
    const reply = { error: { code: -32603, message: 'synthetic-do-not-record' } };

    const act = () => projectMcpAnswer(reply, {});

    expect(act).toThrow('MCP artificial: código -32603');
  });

  it('serveElicitation_invalidAction_returnsArtificialError', () => {
    const input = new EventEmitter();
    const output = [];
    serveElicitation({ readLines: () => input, write: (line) => output.push(JSON.parse(line)) });

    input.emit('line', JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'confirmation' } }));
    input.emit('line', JSON.stringify({ id: output[0].id, result: { action: 'invalid' } }));

    expect(output[1].result).toEqual({ content: [{ type: 'text', text: 'MAGE_ELICITATION_INVALID_RESPONSE' }], isError: true });
  });
});

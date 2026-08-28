const test = require('node:test');
const assert = require('node:assert/strict');

const {
  expandedBands,
  humanDuration,
  normalizeBand,
  normalizeGuestAction,
  parseDuration,
  response,
  startServer,
} = require('./server');

test('exports the server starter used by the hardened launcher', () => {
  assert.equal(typeof startServer, 'function');
});

test('parses Alexa ISO-8601 durations', () => {
  assert.equal(parseDuration('PT30M'), 30 * 60 * 1000);
  assert.equal(parseDuration('PT2H'), 2 * 60 * 60 * 1000);
  assert.equal(parseDuration('PT1H30M'), 90 * 60 * 1000);
  assert.equal(parseDuration('P1D'), 24 * 60 * 60 * 1000);
  assert.equal(parseDuration('invalid'), null);
});

test('formats natural Portuguese durations', () => {
  assert.equal(humanDuration(60 * 60 * 1000), '1 hora');
  assert.equal(humanDuration(90 * 60 * 1000), '1 hora e 30 minutos');
  assert.equal(humanDuration(2 * 60 * 60 * 1000), '2 horas');
});

test('normalizes and expands guest bands', () => {
  assert.equal(normalizeBand('2,4'), '2.4');
  assert.equal(normalizeBand('ambas'), 'todas');
  assert.deepEqual(expandedBands('todas'), ['2.4', '5']);
});

test('normalizes natural Portuguese guest actions', () => {
  for (const value of ['ligar', 'liga', 'ligue', 'ative', 'habilite', 'acenda']) {
    assert.equal(normalizeGuestAction(value), 'ligar');
  }
  for (const value of ['desligar', 'desliga', 'desligue', 'desative', 'desabilite', 'apague']) {
    assert.equal(normalizeGuestAction(value), 'desligar');
  }
});

test('keeps the conversation open and explicitly offers another interaction', () => {
  const result = response('Operação concluída.', true);
  assert.equal(result.shouldEndSession, false);
  assert.match(result.outputSpeech.text, /Operação concluída\. Deseja saber mais alguma coisa do seu roteador\?/);
  assert.match(result.reprompt.outputSpeech.text, /diga sim/i);
});

test('closes the conversation when no follow-up is requested', () => {
  const result = response('Até logo.');
  assert.equal(result.shouldEndSession, true);
  assert.equal(result.reprompt, undefined);
});

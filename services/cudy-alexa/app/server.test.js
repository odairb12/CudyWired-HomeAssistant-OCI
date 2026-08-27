const test = require('node:test');
const assert = require('node:assert/strict');

const {
  expandedBands,
  humanDuration,
  normalizeBand,
  parseDuration,
} = require('./server');

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

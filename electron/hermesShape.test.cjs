const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanUrl, modelFrom, isPage, isLoginWall } = require('./hermesShape.cjs');

test('cleanUrl adds the scheme and /v1 and drops a pasted completions path', () => {
  assert.equal(cleanUrl('10.1.1.3:8642'), 'http://10.1.1.3:8642/v1');
  assert.equal(cleanUrl('http://10.1.1.3:8642/v1/chat/completions'), 'http://10.1.1.3:8642/v1');
  assert.equal(cleanUrl('https://hermes.example/v1/'), 'https://hermes.example/v1');
  assert.equal(cleanUrl('   '), null);
});

test('modelFrom picks the first model out of a /v1/models answer', () => {
  assert.equal(modelFrom('{"data":[{"id":"hermes-4"},{"id":"other"}]}'), 'hermes-4');
  assert.equal(modelFrom('{"data":[]}'), null);
  assert.equal(modelFrom('<!doctype html>'), null);
});

test("isPage tells the dashboard's web page from an API answer", () => {
  assert.equal(isPage('<!DOCTYPE html><html><head><title>Hermes</title></head></html>'), true);
  assert.equal(isPage('\n<html lang="en">'), true);
  assert.equal(isPage('{"data":[{"id":"hermes-4"}]}'), false);
  assert.equal(isPage(''), false);
  assert.equal(isPage('not json either'), false);
});

test('isLoginWall spots the dashboard asking for a browser login', () => {
  assert.equal(isLoginWall('{"error":"session_expired","detail":"Unauthorized","reason":"invalid_or_expired_session","login_url":"/login"}'), true);
  assert.equal(isLoginWall('{"detail":"Invalid API key"}'), false);
  assert.equal(isLoginWall('Unauthorized'), false);
  assert.equal(isLoginWall('<form action="/auth/password-login">'), true);
});

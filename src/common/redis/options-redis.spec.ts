import { Redis } from 'ioredis';
import { optionsConnexionBullmq } from './options-redis';

describe('optionsConnexionBullmq', () => {
  it('redis:// en clair : hôte et port, sans tls ni identifiants', () => {
    const options = optionsConnexionBullmq('redis://localhost:6379');
    expect(options).toEqual({ host: 'localhost', port: 6379 });
    expect(options).not.toHaveProperty('tls');
    expect(options).not.toHaveProperty('db');
    expect(options.username).toBeUndefined();
    expect(options.password).toBeUndefined();
  });

  it('rediss:// : tls actif, identifiants décodés', () => {
    const options = optionsConnexionBullmq(
      'rediss://default:mot%40de%3Apasse@exemple.render.com:6380',
    );
    expect(options.tls).toEqual({});
    expect(options.host).toBe('exemple.render.com');
    expect(options.port).toBe(6380);
    expect(options.username).toBe('default');
    expect(options.password).toBe('mot@de:passe');
  });

  it('lit la base numérique du chemin', () => {
    const options = optionsConnexionBullmq('redis://:secret@hote:6379/2');
    expect(options.db).toBe(2);
    expect(options.username).toBeUndefined();
    expect(options.password).toBe('secret');
  });

  it('port 6379 par défaut', () => {
    expect(optionsConnexionBullmq('redis://hote').port).toBe(6379);
  });
});

describe('ioredis et rediss:// (client partagé et adapter socket.io)', () => {
  it('rediss:// : tls posé par ioredis et recopié par duplicate()', () => {
    const client = new Redis('rediss://:secret@exemple.render.com:6380', {
      lazyConnect: true,
    });
    expect(client.options.tls).toBeTruthy();
    expect(client.options.port).toBe(6380);
    const sub = client.duplicate();
    expect(sub.options.tls).toBeTruthy();
    client.disconnect();
    sub.disconnect();
  });

  it('redis:// : pas de tls', () => {
    const client = new Redis('redis://hote:6379', { lazyConnect: true });
    expect(client.options.tls).toBeUndefined();
    client.disconnect();
  });
});

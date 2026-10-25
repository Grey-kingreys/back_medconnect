import 'reflect-metadata';
import { UserController } from './user.controller';

/**
 * Non-régression D201 : UserResponseDto filtre par excludeExtraneousValues, donc
 * la structure n'est renvoyée que si elle y est exposée.
 */
describe('UserController : structure de rattachement (U1)', () => {
  let userService: { getUsers: jest.Mock; getUser: jest.Mock };
  let controller: UserController;

  beforeEach(() => {
    userService = { getUsers: jest.fn(), getUser: jest.fn() };
    controller = new UserController(userService as never, {} as never);
  });

  it('getUsers : ne garde que id, nom et type de la structure, et jamais le mot de passe', async () => {
    userService.getUsers.mockResolvedValue({
      data: [
        {
          id: 'u1',
          email: 'a@b.gn',
          password: 'hash',
          structure: {
            id: 's1',
            nom: 'Phamarcie la belle etoile',
            type: 'PHARMACIE',
            email: 'x@y.gn',
          },
        },
      ],
      message: 'ok',
      success: true,
    });

    const res = await controller.getUsers();

    const data = JSON.parse(JSON.stringify(res.data)) as Array<
      Record<string, unknown>
    >;
    expect(data[0].structure).toEqual({
      id: 's1',
      nom: 'Phamarcie la belle etoile',
      type: 'PHARMACIE',
    });
    expect(data[0]).not.toHaveProperty('password');
  });

  it('getUsers : structure null reste null', async () => {
    userService.getUsers.mockResolvedValue({
      data: [{ id: 'u3', email: 'c@d.gn', structure: null }],
      message: 'ok',
      success: true,
    });

    const res = await controller.getUsers();

    const data = JSON.parse(JSON.stringify(res.data)) as Array<
      Record<string, unknown>
    >;
    expect(data[0].structure).toBeNull();
  });

  it('getUser : renvoie la structure du compte', async () => {
    userService.getUser.mockResolvedValue({
      data: {
        id: 'u1',
        email: 'a@b.gn',
        structure: {
          id: 's1',
          nom: 'Phamarcie la belle etoile',
          type: 'PHARMACIE',
        },
      },
      message: 'ok',
      success: true,
    });

    const res = await controller.getUser('u1');

    expect(res.data.structure?.nom).toBe('Phamarcie la belle etoile');
  });
});

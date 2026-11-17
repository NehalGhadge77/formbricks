import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@formbricks/database";
import { resetDb } from "@/integration/reset-db";
import { getUsers } from "@/modules/api/v2/organizations/[organizationId]/users/lib/users";
import { ZGetUsersFilter } from "@/modules/api/v2/organizations/[organizationId]/users/types/users";

describe("getUsers organization team scoping (#9802)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  test("returns only the requested organization's teams without excluding users who have none", async () => {
    const organizationA = await prisma.organization.create({ data: { name: "Organization A" } });
    const organizationB = await prisma.organization.create({ data: { name: "Organization B" } });
    const sharedUser = await prisma.user.create({
      data: {
        name: "Shared user",
        email: "shared@issue9802.test",
        memberships: {
          create: [
            { organizationId: organizationA.id, role: "admin" },
            { organizationId: organizationB.id, role: "member" },
          ],
        },
      },
    });
    const otherTeamUser = await prisma.user.create({
      data: {
        name: "No teams in A",
        email: "other-team@issue9802.test",
        memberships: {
          create: [
            { organizationId: organizationA.id, role: "member" },
            { organizationId: organizationB.id, role: "member" },
          ],
        },
      },
    });
    const teamlessUser = await prisma.user.create({
      data: {
        name: "No teams",
        email: "teamless@issue9802.test",
        memberships: { create: { organizationId: organizationA.id, role: "member" } },
      },
    });
    const outsideUser = await prisma.user.create({
      data: {
        email: "outside@issue9802.test",
        memberships: { create: { organizationId: organizationB.id, role: "member" } },
      },
    });
    await prisma.team.create({
      data: {
        name: "Team A",
        organizationId: organizationA.id,
        teamUsers: { create: { userId: sharedUser.id, role: "contributor" } },
      },
    });
    await prisma.team.create({
      data: {
        name: "Team B",
        organizationId: organizationB.id,
        teamUsers: {
          create: [sharedUser, otherTeamUser, outsideUser].map((user) => ({
            userId: user.id,
            role: "contributor",
          })),
        },
      },
    });

    const result = await getUsers(organizationA.id, ZGetUsersFilter.parse({ limit: 10, skip: 0 }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.data.meta).toEqual({ total: 3, limit: 10, offset: 0 });
    expect(result.data.data).toHaveLength(3);
    expect(result.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sharedUser.id, role: "admin", teams: ["Team A"] }),
        expect.objectContaining({ id: otherTeamUser.id, role: "member", teams: [] }),
        expect.objectContaining({ id: teamlessUser.id, role: "member", teams: [] }),
      ])
    );

    const filtered = await getUsers(
      organizationB.id,
      ZGetUsersFilter.parse({ id: sharedUser.id, limit: 1, skip: 0 })
    );
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) throw new Error(JSON.stringify(filtered.error));
    expect(filtered.data.meta).toEqual({ total: 1, limit: 1, offset: 0 });
    expect(filtered.data.data).toEqual([
      expect.objectContaining({ id: sharedUser.id, role: "member", teams: ["Team B"] }),
    ]);
  });
});

import type { L4d2CounterName, L4d2WeaponIdentity } from "@l4dstats/contracts";

export const l4d2CounterNames = [
  "m_checkpointSurvivorDamage",
  "m_checkpointMedkitsUsed",
  "m_checkpointPillsUsed",
  "m_checkpointMolotovsUsed",
  "m_checkpointPipebombsUsed",
  "m_checkpointBoomerBilesUsed",
  "m_checkpointAdrenalinesUsed",
  "m_checkpointDefibrillatorsUsed",
  "m_checkpointDamageTaken",
  "m_checkpointFirstAidShared",
  "m_checkpointDamageToTank",
  "m_checkpointDamageToWitch",
  "m_missionAccuracy",
  "m_checkpointHeadshots",
  "m_checkpointHeadshotAccuracy",
  "m_checkpointDeaths",
  "m_checkpointMeleeKills",
  "m_checkpointPZTankDamage",
  "m_checkpointPZHunterDamage",
  "m_checkpointPZSmokerDamage",
  "m_checkpointPZBoomerDamage",
  "m_checkpointPZJockeyDamage",
  "m_checkpointPZSpitterDamage",
  "m_checkpointPZChargerDamage",
  "m_checkpointPZKills",
  "m_checkpointPZPushes",
  "m_checkpointPZTankPunches",
  "m_checkpointPZTankThrows",
  "m_checkpointPZHung",
  "m_checkpointPZPulled",
  "m_checkpointPZBombed",
  "m_checkpointPZVomited",
  "m_checkpointPZLongestSmokerGrab",
  "m_checkpointPZNumChargeVictims",
] as const satisfies readonly L4d2CounterName[];

const weaponNames = [
  "Empty",
  "Pistol",
  "SMG",
  "Pump Shotgun",
  "Auto Shotgun",
  "Assault Rifle",
  "Hunting Rifle",
  "Silenced SMG",
  "Chrome Shotgun",
  "Desert Rifle",
  "Military Sniper",
  "SPAS Shotgun",
  "First Aid Kit",
  "Molotov",
  "Pipe Bomb",
  "Pain Pills",
  "Gas Can",
  "Propane Tank",
  "Oxygen Tank",
  "Melee Weapon",
  "Chainsaw",
  "Grenade Launcher",
  "Ammo Pack",
  "Adrenaline",
  "Defibrillator",
  "Boomer Bile",
  "AK-47",
  "Gnome Chompski",
  "Cola Bottles",
  "Fireworks Box",
  "Incendiary Ammo",
  "Explosive Ammo",
  "Magnum",
  "MP5",
  "SG 552",
  "AWP",
  "Scout",
  "M60",
  "Tank Claw",
  "Hunter Claw",
  "Charger Claw",
  "Boomer Claw",
  "Smoker Claw",
  "Spitter Claw",
  "Jockey Claw",
  "Mounted Machine Gun",
  "Fatal Vomit",
  "Exploding Splat",
  "Lunge Pounce",
  "Lounge",
  "Full Pull",
  "Choke",
  "Tank Rock",
  "Hittable Physics",
  "Ammo",
  "Upgrade Item",
] as const;

export function l4d2WeaponIdentity(id: number): L4d2WeaponIdentity {
  const category: L4d2WeaponIdentity["category"] =
    id === 0
      ? "unknown"
      : id >= 38 && id <= 52
        ? "infected"
        : [1, 19, 20, 32].includes(id)
          ? "secondary"
          : [
                2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 21, 26, 33, 34, 35, 36, 37,
              ].includes(id)
            ? "primary"
            : [12, 24].includes(id)
              ? "medical"
              : [15, 23].includes(id)
                ? "temporary-health"
                : [13, 14, 22, 25, 30, 31, 55].includes(id)
                  ? "utility"
                  : "world";
  return { id, name: weaponNames[id] ?? `Unknown weapon ID ${id}`, category };
}

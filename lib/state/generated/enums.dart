// GENERATED FILE - DO NOT EDIT MANUALLY
// Source: server roles.config.json and domain FSM

import 'package:flutter/foundation.dart';

// Keep in sync with server/src/domain/fsm.ts transitions keys
enum GamePhase { LOBBY, ROLES, NIGHT_THIEF, NIGHT_CUPID, NIGHT_LOVERS, NIGHT_SEER, NIGHT_WOLVES, NIGHT_WITCH, MORNING, VOTE, RESOLVE, CHECK_END, END }
GamePhase phaseFromStr(String s) => GamePhase.values.firstWhere((e) => describeEnum(e) == s);

// Keep in sync with server/roles.config.json registry keys
enum Role { CUPID, HUNTER, SEER, THIEF, VILLAGER, WITCH, WOLF }
Role roleFromStr(String s) => Role.values.firstWhere((e) => describeEnum(e) == s);

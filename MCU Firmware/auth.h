#ifndef AUTH_H
#define AUTH_H

#include <stddef.h>
#include <stdint.h>


bool devicePasswordMatches(const char *s, size_t len);

bool authIsLockedOut(uint32_t ip);

unsigned long authLockoutRemainingMs(uint32_t ip);

void authRecordResult(uint32_t ip, bool ok);

#endif

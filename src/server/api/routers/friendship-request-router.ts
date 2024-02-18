import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FriendshipStatusSchema } from '@/utils/server/friendship-schemas'
import { authGuard } from '@/server/trpc/middlewares/auth-guard'
import { procedure } from '@/server/trpc/procedures'
import { IdSchema } from '@/utils/server/base-schemas'
import { router } from '@/server/trpc/router'

const SendFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canSendFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = SendFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('users')
      .where('users.id', '=', friendUserId)
      .select('id')
      .limit(1)
      .executeTakeFirstOrThrow(
        () =>
          new TRPCError({
            code: 'BAD_REQUEST',
          })
      )

    return next({ ctx })
  }
)

const AnswerFriendshipRequestInputSchema = z.object({
  friendUserId: IdSchema,
})

const canAnswerFriendshipRequest = authGuard.unstable_pipe(
  async ({ ctx, rawInput, next }) => {
    const { friendUserId } = AnswerFriendshipRequestInputSchema.parse(rawInput)

    await ctx.db
      .selectFrom('friendships')
      .where('friendships.userId', '=', friendUserId)
      .where('friendships.friendUserId', '=', ctx.session.userId)
      .where(
        'friendships.status',
        '=',
        FriendshipStatusSchema.Values['requested']
      )
      .select('friendships.id')
      .limit(1)
      .executeTakeFirstOrThrow(() => {
        throw new TRPCError({
          code: 'BAD_REQUEST',
        })
      })

    return next({ ctx })
  }
)

export const friendshipRequestRouter = router({
  send: procedure
    .use(canSendFriendshipRequest)
    .input(SendFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      /**
       * Question 3: Fix bug
       *
       * Fix a bug where our users could not send a friendship request after
       * they'd previously been declined. Steps to reproduce:
       *  1. User A sends a friendship request to User B
       *  2. User B declines the friendship request
       *  3. User A tries to send another friendship request to User B -> ERROR
       *
       * Instructions:
       *  - Go to src/server/tests/friendship-request.test.ts, enable the test
       * scenario for Question 3
       *  - Run `yarn test` to verify your answer
       */

      // Code check if the friendship request already exists ? get the status : ...
      const friendshipRequestExists = await ctx.db
        .selectFrom('friendships')
        .where('userId', '=', ctx.session.userId)
        .where('friendUserId', '=', input.friendUserId)
        .select('status')
        .executeTakeFirst()

      if (friendshipRequestExists) {
        // If the friendship request already exists and the status is `declined`, update the status to `requested` and return
        if (
          friendshipRequestExists.status ===
          FriendshipStatusSchema.Values['declined']
        ) {
          await ctx.db
            .updateTable('friendships')
            .set({ status: FriendshipStatusSchema.Values['requested'] })
            .where('userId', '=', ctx.session.userId)
            .where('friendUserId', '=', input.friendUserId)
            .executeTakeFirst()
          return
        } else if (
          friendshipRequestExists.status ===
          FriendshipStatusSchema.Values['requested']
        ) {
          return
        }
      }

      // If the friendship request does not exist, create a new friendship request record
      return ctx.db
        .insertInto('friendships')
        .values({
          userId: ctx.session.userId,
          friendUserId: input.friendUserId,
          status: FriendshipStatusSchema.Values['requested'],
        })
        .execute()
    }),

  accept: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction().execute(async (t) => {
        /**
         * Question 1: Implement api to accept a friendship request
         *
         * When a user accepts a friendship request, we need to:
         *  1. Update the friendship request to have status `accepted`
         *  2. Create a new friendship request record with the opposite user as the friend
         *
         * The end result that we want will look something like this
         *
         *  | userId | friendUserId | status   |
         *  | ------ | ------------ | -------- |
         *  | 1      | 2            | accepted |
         *  | 2      | 1            | accepted |
         *
         * Instructions:
         *  - Your answer must be inside this transaction code block
         *  - Run `yarn test` to verify your answer
         *
         * Documentation references:
         *  - https://kysely-org.github.io/kysely/classes/Transaction.html#transaction
         *  - https://kysely-org.github.io/kysely/classes/Kysely.html#insertInto
         *  - https://kysely-org.github.io/kysely/classes/Kysely.html#updateTable
         */

        // Update the friendship request to have status `accepted`
        await t
          .updateTable('friendships')
          .set({ status: FriendshipStatusSchema.Values['accepted'] })
          .where('userId', '=', input.friendUserId)
          .where('friendUserId', '=', ctx.session.userId)
          .executeTakeFirst()

        // Create a new friendship request record with the opposite user as the friend
        // Code check the friendship request already exists
        const friendshipExists = await t
          .selectFrom('friendships')
          .select('id')
          .where('userId', '=', ctx.session.userId)
          .where('friendUserId', '=', input.friendUserId)
          .executeTakeFirst()

        // If the friendship request does not exist, create a new friendship request record with the opposite user as the friend
        if (!friendshipExists) {
          await t
            .insertInto('friendships')
            .values({
              userId: ctx.session.userId,
              friendUserId: input.friendUserId,
              status: FriendshipStatusSchema.Values['accepted'],
            })
            .executeTakeFirst()
        }

        // If the friendship request already exists, update the status to accepted
        else {
          await t
            .updateTable('friendships')
            .set({ status: FriendshipStatusSchema.Values['accepted'] })
            .where('userId', '=', ctx.session.userId)
            .where('friendUserId', '=', input.friendUserId)
            .executeTakeFirst()
        }
      })
    }),

  decline: procedure
    .use(canAnswerFriendshipRequest)
    .input(AnswerFriendshipRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      /**
       * Question 2: Implement api to decline a friendship request
       *
       * Set the friendship request status to `declined`
       *
       * Instructions:
       *  - Go to src/server/tests/friendship-request.test.ts, enable the test
       * scenario for Question 2
       *  - Run `yarn test` to verify your answer
       *
       * Documentation references:
       *  - https://vitest.dev/api/#test-skip
       */

      // Set the friendship request status to `declined`
      await ctx.db
        .updateTable('friendships')
        .set({ status: FriendshipStatusSchema.Values['declined'] })
        .where('userId', '=', input.friendUserId)
        .where('friendUserId', '=', ctx.session.userId)
        .executeTakeFirst()
    }),
})

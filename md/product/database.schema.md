# Database Schema & Entity Relationships

## 1. Overview

- **Database Type:** [e.g., PostgreSQL / MongoDB]
- **ORM:** [e.g., Prisma / Mongoose]

## 2. Entity Relationships (ERD)

- **User** `1 -- N` **Posts** (One user has many posts).
- **Post** `N -- N` **Tags** (Posts can have many tags, tags belong to many posts).

## 3. Table Definitions

### Table: `Users`

| Column Name    | Type     | Constraints     | Description                   |
| :------------- | :------- | :-------------- | :---------------------------- |
| `id`           | UUID     | PK, Unique      | Unique identifier.            |
| `email`        | String   | Unique, Index   | User's email address.         |
| `passwordHash` | String   | Not Null        | Argon2 hashed password.       |
| `role`         | Enum     | Default: 'USER' | 'USER', 'ADMIN', 'MODERATOR'. |
| `createdAt`    | DateTime | Default: Now    |                               |

### Table: `Markets` (Example)

| Column Name | Type   | Constraints      | Description                |
| :---------- | :----- | :--------------- | :------------------------- |
| `id`        | UUID   | PK               |                            |
| `ownerId`   | UUID   | FK -> Users.id   | The creator of the market. |
| `title`     | String | Max: 100 chars   |                            |
| `status`    | Enum   | 'OPEN', 'CLOSED' |                            |

## 4. Indexes & Performance

- **Compound Index:** `[status, createdAt]` on `Markets` table for fast filtering of active markets.
- **Text Index:** `title` on `Markets` for search.

---
name: setup
description: Set up Packrat for the repository you're in, from the first sign-in to the pull request that installs it. Use when the user asks to set up, install, add or connect Packrat in this app or repository, or when a Packrat command says no app is connected to the repository.
allowed-tools: Bash(packrat:*)
---

# Set up Packrat

`packrat setup` does every step it can from here, shows how far the others have come, and ends by
naming the next one. Run it, do the step it names, and run it again until it says setup is complete.

```bash
packrat setup
```

Each run prints one row for each step. Read the rows and the line that starts with `Next:`, then act on
it as follows.

## Signed in

If `packrat setup` reports that you are not signed in, ask the user to run `! packrat login`. The
sign-in is approved in the user's browser, so you cannot complete it for them. Run `packrat setup`
again once they have.

## Which org

If setup answers that you belong to more than one org and none of them reads this repository, it lists
the orgs. Ask the user which one to set up, then run `packrat setup --org <org id>` with the id they
choose. Pass the same `--org` on every later run.

## GitHub

When the GitHub row is waiting, setup prints a page to approve Packrat on GitHub and stops. Give the
user that page, exactly as printed, and ask them to approve Packrat for this repository there. GitHub
asks them to choose the account that owns the repository and to include it. Run `packrat setup` again
once they say they have.

## An app with no repository

Packrat may already receive data from apps that have no repository. Setup connects the one whose name
`config/application.rb` gives this app. When none matches, the App row lists them and setup stops. Ask
the user which one this repository is, or whether it is a new app, then run one of:

```bash
packrat setup --app <app>
packrat setup --new
```

Do not choose for the user.

## The setup pull request

When setup prints `Run packrat open <page> and follow its steps`, run that command and follow the page
it prints. The page installs the Packrat gem, checks that Packrat receives data from the app, and ends
by opening the setup pull request. Do not start another Claude Code session for it.

## After the pull request

Once the pull request is open, run `packrat setup` again and tell the user what is left: merging the
pull request and deploying it to production. Packrat runs the pull request's checks once the deploy
goes live. `packrat setup` says setup is complete once they pass.

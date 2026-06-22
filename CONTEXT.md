# Bananagrams Puzzle — Domain Glossary

## Tile
A single letter piece. Letters follow Bananagrams frequency distribution.

## Tile Bag
The shuffled collection of all tiles not yet drawn. Empties over the course of a game.

## Unclaimed Area
The pool of drawn tiles not yet part of any Word. Maximum capacity: 10 tiles. A player may Draw whenever the Unclaimed Area has fewer than 10 tiles.

## Draw
The player action of taking one Tile from the Tile Bag and placing it in the Unclaimed Area. Only available when the Unclaimed Area holds fewer than 10 tiles.

## Claim
The player action of forming a new Word from 4 or more tiles in the Unclaimed Area. Those tiles are removed from the Unclaimed Area permanently.

## Word
A valid Scrabble-dictionary word of 4 or more letters. Its tiles are permanently Claimed — they never return to the Unclaimed Area. A Word can only change via Extend, Anagram, or Recombine.

## Extend
The player action of incorporating one or more Unclaimed tiles into an existing Word. The resulting word must contain every letter of the existing Word (freely rearranged) plus at least one tile from the Unclaimed Area, and must be a valid Scrabble word. The Word grows longer; the Unclaimed Area shrinks.

## Anagram
A player action that rearranges an existing Word's letters into a different valid Scrabble word of the same length. No tiles are consumed from the Unclaimed Area. Score is unchanged. Useful for setting up a future Extend or Recombine.

## Recombine
The player action of merging two or more Words into a single new Word. The new word must use every letter from every combined Word, and may additionally consume tiles from the Unclaimed Area. All source Words are dissolved; the new Word replaces them. Must be a valid Scrabble word.

## Score
The sum of (word length − 2) across all current Words.

## Stuck State
Occurs when the Unclaimed Area is at its 10-tile maximum and no valid 4-letter-or-longer Scrabble word can be formed from those tiles. No moves are available. Accepted imperfection in the initial implementation — no escape mechanism yet.

## Classical Mode
A game mode with a count-up timer starting at zero. When the Tile Bag empties, Drawing is no longer available but the player may continue to Claim, Extend, Anagram, and Recombine until they explicitly declare done. Tiles remaining in the Unclaimed Area at end are neutral — no score effect.

## Time-Limited Mode
A game mode with a count-down timer that ends the game at zero. Three time controls, no increment:
- Bullet: 1 minute
- Blitz: 3 minutes
- Rapid: 10 minutes

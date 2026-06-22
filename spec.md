Designing a puzzle game based on the bananagram tiles. I want to create a prototype something that I have hopes can become a bit like Wordle.

Gameplay.

A player reveals tiles one by one that are random letters pulled from a shuffled set of letters following the same frequency of letters as banana grams.

Each tile goes into an unclaimed area.

Once you have more than four tiles you can start claiming words no smaller than four letters in length.

You can keep drawing from the tiles and getting new words or extending the words that you have by rearranging the letters of a word you've already taken and adding new letters from the unclaimed area.

You can also recombine your words if there is a new word that uses all the letters of two of your words or more.

You can do the same thing but combining two words and letters from the unclaimed area.

The point scoring is 2.4, a 4 letter word, 3 points for a 5 letter word and so on. So it's length minus 2 for the scoring of each word and then this course for each word are summed to get your total score.

For this prototype, let's keep the gameplay stack really simple. I want it to run in a browser, I want it to look a little bit like a New York Times game. o take Wordel or connections as a reference point and I don't want to have a framework involved. Just plain Javacript, custom elements, C, HTML.

An extension to this in order to make it a true puzzle would be to, when you open the app each day, start with a set number of letters that are fixed in the unclaimed area and have the users try and get the highest score, there might even be words that they've already claimed, so you're essentially jumping into it mid game and the person setting the puzzle knows that there is a good chain of words to get a different level of scores based on your ability. Let's just build for the simple Fresh game all the way through use case first.

Use the given template npm workspace to create a webapp called happy-bounce where users 
* can register (use the existing user registration)
* user can buy "coins"
  * this ca be a mockup where you can simply "buy" coins by clicking a button (a 1 coin button, 10 coin button and a 100 coin button)
* create "levels" that can be private or public
  * please use a kaizen extracted version of the floating toolbar ui system used in the ../../asimov-happy devapp for the menus
  * the game should use webgl 2 for drawing the game and the game should be as performance optimized as possible
    * please also create performance tests for the game engine modelled after a kaizen extracted version of the performance test for ../../asimov-happy
* levels are a 2d surface with a user selectable background color and size (in cm units) (for the editor the level should also have a border so it is clear what is inside teh level and what is outside)
  * the user can zoom in/out and move around the level surface with the mouse like in the evocell devapp.
* when playing the game the user can spawn balls     
* for now there is no difference between editing the game and playing the game but in the final version playing the game means you have to guide a certain ammount of bouncing balls through placing rubber bands between a predefined set of points or the player could also be able to spawn a certain number of points and rubber bands.
* the settongs of teh rubber badn should be editable in a toolbar.
* the balls can be spawned in 


In ../../asimov-happy there is the evocell DevApp that should be used as an architectural inspiration for certain aspects of the app. Please always use minimalistic kaizen principles (the best code is the one we did not have to write at all; our aspiration is to deliver a better app with fewer lines of code) and always only extract what makes sense for our app (which is not as complex as the cellular automata DevApp)
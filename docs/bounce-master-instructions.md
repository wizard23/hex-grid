Use the given template npm workspace to create the specs for a webapp called happy-bounce. 
Please create the specs for the app in ./docs/specs 

The app should allow: 
* new users can register (use the existing user registration)
* existing users can login (use the existing infrastructure for this as well)
* user can buy "coins"
  * this ca be a mockup where you can simply "buy" coins by clicking a button (a 1 coin button, 10 coin button and a 100 coin button)
* create "levels" that can be private or public
  * please use a kaizen extracted version of the floating toolbar ui system used in the ../../asimov-happy devapp for the menus
  * the game should use webgl 2 for drawing the game and the game should be as performance optimized as possible
    * please also create performance tests for the game engine modelled after a kaizen extracted version of the performance test for ../../asimov-happy
* levels are a 2d surface with a user selectable background color and size (in cm units) (for the editor the level should also have a border so it is clear what is inside teh level and what is outside)
  * the user can zoom in/out and move around the level surface with the mouse like in the evocell devapp.
* the user can spawn balls that are simulated via classical newtonian dynamics. The parameters of the physics are part of the level data.
* the user can place and remove "pegs"      
* for now there is no difference between editing the game and playing the game but in the final version playing the game means you have to guide a certain amount of bouncing balls to some exit by placing rubber bands between a predefined set of pegs or the player could also be able to spawn a certain number of pegs and rubber bands.
* the settings of th rubber bands should be editable in a toolbar.
* there should be tools for the editor (like in the devapp). Each tool allows different mouse interactions
   * a tool for editing pegs. when this tool is selected the user can drag pegs around and create pegs by double click. Pegs can be selected and deleted by pressing "Backspace" "D" or "Delete"
   * a tool for editing rubber bands. the user can click at a peg and while keeping the mouse button pressed stretch rubber bands between pegs. The rubber band is dragged onto the target peg thereby connecting 
* the balls can be spawned in by pressing the left mouse button (when in ball spawning mode)


Open questions I see (please grill me about all open questions you see so we can create a clesn kaizen spec)
* how to simulate the stretching rubber bands. I would like the rubber to really stretch and deform and also be able to vibrate at the physically correct rate. At the same time the simulation should support at least 1000 balls and 100 rubber bands at 60 fps.
*

In ../../asimov-happy there is the evocell DevApp that should be used as an architectural inspiration for certain aspects of the app. Please always use minimalistic kaizen principles (the best code is the one we did not have to write at all; our aspiration is to deliver a better app with fewer lines of code) and always only extract what makes sense for our app (which is not as complex as the cellular automata DevApp)

